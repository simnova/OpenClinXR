#!/usr/bin/env tsx
// regrade.mts — bounded case-colour regrade (portable).
// Stages the REAL ED case skin tone as a LINEAR baseColorFactor on a work copy,
// executes the EXISTING shipped baker (bakeGlbAlbedo: linear-correct sRGB
// transfer, no resample), extracts the baked PNG, verifies the factor returned
// white. No fixed paths: repo root + all locations are CLI arguments.
// Case tone is read from the ACTUAL fixture module (preferred) or the actual
// generated receipt (with caseModule SHA validation). RGB comes from a SAFE
// regex literal-parse of SKIN_TONE_RGB in the shipped producer (never executed).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function arg(name: string, required = true): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (required && !v) throw new Error(`missing --${name}`);
  return v!;
}
const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

const repoRoot = arg("repo-root");
const input = arg("input");
const workDir = arg("work-dir");
const pngOut = arg("png-out");
const report = arg("report");
const expIn = arg("expected-input-sha");
const receiptPath = arg("receipt", false) || path.join(repoRoot, "tools/openclinxr/evidence/blender/ed-gown-phenotype-receipt.json");
const caseModule = arg("case-module", false) || path.join(repoRoot, "packages/openclinxr/scenario-fixtures/src/ed-chest-pain-mod.ts");
for (const p of [input, receiptPath, caseModule]) if (!existsSync(p)) throw new Error(`REFUSE: missing input ${p}`);
for (const p of [pngOut, report]) if (existsSync(p)) throw new Error(`REFUSE: no-clobber, exists: ${p}`);
const raw = readFileSync(input);
if (sha(raw) !== expIn) throw new Error("REFUSE: input sha mismatch");
mkdirSync(workDir, { recursive: true });
const WORK = path.join(workDir, "tint-work.glb");
const BAKED = path.join(workDir, "tint-baked.glb");
if (existsSync(WORK) || existsSync(BAKED)) throw new Error("REFUSE: no-clobber, work outputs exist");

// --- actual case tone: fixture module first, receipt+SHA fallback ---
let skinTone: string | undefined;
let toneSource = "";
try {
  const mod = await import(caseModule);
  outer: for (const v of Object.values(mod)) {
    const sc = v as any;
    if (sc && Array.isArray(sc.actors)) {
      const a = sc.actors.find((x: any) => x?.actorId === "patient_robert_hayes_v1");
      if (a?.phenotype?.skin_tone) { skinTone = a.phenotype.skin_tone; toneSource = `fixture:${path.basename(caseModule)}#patient_robert_hayes_v1.phenotype.skin_tone`; break outer; }
    }
  }
} catch { /* fall through to receipt */ }
if (!skinTone) {
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const modBytes = readFileSync(caseModule);
  if (receipt.caseModuleSha256 !== sha(modBytes)) throw new Error("REFUSE: receipt caseModuleSha mismatch");
  const row = (receipt.mapping as any[]).find((m) => m.field === "skin_tone");
  if (!row || row.match !== true) throw new Error("REFUSE: receipt has no exact skin_tone row");
  skinTone = row.case;
  toneSource = `receipt:${path.basename(receiptPath)}#mapping.skin_tone (caseModuleSha validated)`;
}

// --- RGB from shipped SKIN_TONE_RGB via safe literal parse (producer never executed) ---
const producer = readFileSync(path.join(repoRoot, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py"), "utf8");
const m = producer.match(new RegExp(`"${skinTone}"\\s*:\\s*\\(\\s*([0-9.]+)\\s*,\\s*([0-9.]+)\\s*,\\s*([0-9.]+)\\s*\\)`));
if (!m) throw new Error(`REFUSE: tone ${skinTone} not in shipped SKIN_TONE_RGB`);
const TARGET = [Number(m[1]), Number(m[2]), Number(m[3])];
if (TARGET.some((v) => !(v > 0 && v <= 1))) throw new Error("REFUSE: parsed RGB out of range");

// --- measured UV-baked mean (exact sRGB transfer; cleared background excluded) ---
const { NodeIO } = await import("@gltf-transform/core");
const { bakeGlbAlbedo, decodePng8 } = await import(path.join(repoRoot, "tools/openclinxr/asset-pipeline/trellis/bake-humanoid-albedo.js"));
const jl = raw.readUInt32LE(12);
const j = JSON.parse(raw.subarray(20, 20 + jl).toString("utf8"));
const off = 20 + jl;
const cl = raw.readUInt32LE(off);
const bin = raw.subarray(off + 8, off + 8 + cl);
const mat = (j.materials as any[]).find((x) => x.name === "mpfb_skin_robert_reference");
if (!mat) throw new Error("REFUSE: skin material missing");
const tex = (j.textures as any[])[mat.pbrMetallicRoughness.baseColorTexture.index];
const img = (j.images as any[])[tex.source];
const bv = (j.bufferViews as any[])[img.bufferView];
const pngBytes = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
const dec = decodePng8(new Uint8Array(pngBytes));
const lin = (c: number) => { const u = c / 255; return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); };
const sum = [0, 0, 0];
let n = 0;
for (let i = 0; i < dec.w * dec.h; i++) {
  const r = dec.px[i * dec.chans]!, g = dec.px[i * dec.chans + 1]!, b = dec.px[i * dec.chans + 2]!;
  if (Math.max(r, g, b) <= 10) continue;
  sum[0] += lin(r); sum[1] += lin(g); sum[2] += lin(b); n++;
}
const mean = sum.map((s) => s / n);
const gain = TARGET.map((t, c) => t / mean[c]!);
if (gain.some((v) => !(v >= 0.5 && v <= 2))) throw new Error("REFUSE: gain outside fail-closed [0.5,2]");
console.log(`TONE ${skinTone} via ${toneSource} target=[${TARGET.join(",")}] measured=[${mean.map((v) => v.toFixed(4)).join(",")}] gain=[${gain.map((v) => v.toFixed(4)).join(",")}]`);

const io = new NodeIO();
const doc = await io.read(input);
doc.getRoot().listMaterials().find((x) => x.getName() === "mpfb_skin_robert_reference")!
  .setBaseColorFactor([gain[0]!, gain[1]!, gain[2]!, 1]);
await io.write(WORK, doc);
const row = bakeGlbAlbedo(WORK, BAKED) as any;
const skinRow = row.materials.find((r: any) => r.material === "mpfb_skin_robert_reference");
if (JSON.stringify(skinRow.factorAfter) !== "[1,1,1]") throw new Error("REFUSE: baker did not reset factor");
const out = readFileSync(BAKED);
const ojl = out.readUInt32LE(12);
const oj = JSON.parse(out.subarray(20, 20 + ojl).toString("utf8"));
const ooff = 20 + ojl;
const obin = out.subarray(ooff + 8, ooff + 8 + out.readUInt32LE(ooff));
const omat = (oj.materials as any[]).find((x) => x.name === "mpfb_skin_robert_reference");
if (JSON.stringify(omat.pbrMetallicRoughness.baseColorFactor) !== "[1,1,1,1]") throw new Error("REFUSE: white factor not in bytes");
const otex = (oj.textures as any[])[omat.pbrMetallicRoughness.baseColorTexture.index];
const obv = (oj.bufferViews as any[])[(oj.images as any[])[otex.source].bufferView];
const baked = obin.subarray(obv.byteOffset ?? 0, (obv.byteOffset ?? 0) + obv.byteLength);
if (baked[0] !== 0x89 || baked[1] !== 0x50) throw new Error("REFUSE: extracted bytes are not PNG");
writeFileSync(pngOut, baked);
writeFileSync(report, JSON.stringify({
  schema: "openclinxr.ed-case-tint-report.v1",
  toneSource, skinTone, targetLinear: TARGET, measuredLinearMean: mean, texelCount: n, gain,
  bakerDecision: skinRow.decision, bakedPng: { sha256: sha(baked), bytes: baked.length },
  noResampleNoGeometryChange: "per-texel gain at native 1024x1024; mesh/rig/morph/anim untouched",
}, null, 2) + "\n");
console.log(`EXTRACTED bytes=${baked.length} sha=${sha(baked).slice(0, 16)}`);
