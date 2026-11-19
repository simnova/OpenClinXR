/**
 * run-chain.test.ts — manifest schema validation, write-once refusal, and a
 * 2-stage fake-manifest run proving order plus chain-report shape, and
 * replay checks against shipped humanoid assets.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { POST_EXPORT_STAGE_REGISTRY } from "@openclinxr/factory-station-core/runner";
import { describe, expect, it } from "vitest";
import {
  CHAIN_CLAIM_SCOPE,
  CHAIN_NOT_EVIDENCE_FOR,
  type ChainStage,
  runChain,
  validateManifest,
} from "./run-chain";
import { type GltfRoot, readGlb } from "./ship-superset";

const FAKE = "tools/openclinxr/asset-pipeline/humanoid-chain/tests/helpers/fake-stage.mjs";
const FAKE_FAIL = "tools/openclinxr/asset-pipeline/humanoid-chain/tests/helpers/fake-fail-stage.mjs";
const FAKE_WORKDIR = "tools/openclinxr/asset-pipeline/humanoid-chain/tests/helpers/fake-workdir-stage.mjs";

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "chain-test-"));
}

function writeInput(dir: string): string {
  const p = join(dir, "input.glb");
  writeFileSync(p, Buffer.from("GLB0", "utf8"));
  return p;
}

function writeManifest(dir: string, stages: unknown[]): string {
  const p = join(dir, "manifest.json");
  writeFileSync(p, JSON.stringify({ actorId: "test-actor", stages, excluded: [] }));
  return p;
}

function twoStageManifest(): unknown[] {
  return [
    { id: "01", name: "first", tool: FAKE, kind: "node", argv: ["--input", "{in}", "--output", "{out}", "--tag", "A"] },
    { id: "02", name: "second", tool: FAKE, kind: "node", argv: ["--input", "{in}", "--output", "{out}", "--tag", "B"] },
  ];
}

describe("validateManifest", () => {
  it("refuses an unknown kind", () => {
    expect(() =>
      validateManifest({
        actorId: "test-actor",
        stages: [{ id: "01", name: "x", tool: FAKE, kind: "node2", argv: ["{in}", "{out}"] }],
        excluded: [],
      }),
    ).toThrow(/unknown kind/);
  });

  it("refuses argv with no placeholder", () => {
    expect(() =>
      validateManifest({
        actorId: "test-actor",
        stages: [{ id: "01", name: "x", tool: FAKE, kind: "node", argv: ["--foo", "bar"] }],
        excluded: [],
      }),
    ).toThrow(/missing a placeholder/);
  });

  it("refuses a duplicate stage id", () => {
    expect(() =>
      validateManifest({
        actorId: "test-actor",
        stages: [
          { id: "01", name: "x", tool: FAKE, kind: "node", argv: ["{in}", "{out}"] },
          { id: "01", name: "y", tool: FAKE, kind: "node", argv: ["{in}", "{out}"] },
        ],
        excluded: [],
      }),
    ).toThrow(/duplicate stage id/);
  });

  it("refuses a stage with no {out} and no collectFrom", () => {
    expect(() =>
      validateManifest({
        actorId: "test-actor",
        stages: [{ id: "01", name: "x", tool: FAKE, kind: "node", argv: ["--input", "{in}"] }],
        excluded: [],
      }),
    ).toThrow(/no collectFrom/);
  });

  it("refuses an unknown excluded reason and a missing note", () => {
    expect(() =>
      validateManifest({
        actorId: "test-actor",
        stages: [{ id: "01", name: "x", tool: FAKE, kind: "node", argv: ["{in}", "{out}"] }],
        excluded: [{ id: "02", name: "y", reason: "later", note: "n" }],
      }),
    ).toThrow(/unknown reason/);
    expect(() =>
      validateManifest({
        actorId: "test-actor",
        stages: [{ id: "01", name: "x", tool: FAKE, kind: "node", argv: ["{in}", "{out}"] }],
        excluded: [{ id: "02", name: "y", reason: "gap", note: "" }],
      }),
    ).toThrow(/required non-empty note/);
  });
});

describe("family-partner post-export chain", () => {
  const actor = "mpfb-family-partner-adult";
  const stageName = "24-hair-material-maps";
  const asset = `apps/ui-xr/public/generated-humanoids/${actor}.glb`;
  const materialName = "openclinxr_fitted_hair_toigo_curled_under_bob_mpfb_ed_chest_pain_spouse_adult_mat";
  const preImageSha = "1fd58873ddba9519d442396635bd2d91a08c8b4b63606b186ecc56a9c0f5cb8b";
  const sha256 = (raw: Buffer) => createHash("sha256").update(raw).digest("hex");

  function hairEvidence(path: string) {
    const { json, bin } = readGlb(path);
    type TextureRef = { index: number };
    const doc = json as GltfRoot & {
      materials: { name: string; pbrMetallicRoughness: { baseColorTexture: TextureRef }; normalTexture: TextureRef }[];
      textures: { source: number; sampler: number }[];
      samplers: Record<string, number>[];
      images: { name: string; mimeType: string; bufferView: number }[];
    };
    const material = doc.materials.find((entry) => entry.name === materialName);
    if (!material) throw new Error(`missing material ${materialName} in ${path}`);
    const textures = [material.pbrMetallicRoughness.baseColorTexture, material.normalTexture].map(({ index }) => {
      const texture = doc.textures[index]!;
      const { name, mimeType, bufferView } = doc.images[texture.source]!;
      const { byteOffset = 0, byteLength } = doc.bufferViews![bufferView]!;
      if (byteLength === undefined) throw new Error(`missing image byte length for ${name}`);
      return { name, mimeType, texture, sampler: doc.samplers[texture.sampler], bytes: bin.subarray(byteOffset, byteOffset + byteLength) };
    });
    return { material, textures };
  }

  it("P1: the manifest validator refuses an unregistered post-export stage and the chain replays it when registered", () => {
    const dir = mkdtempSync(join(process.env["OPENCLINXR_JOB_TMP"] ?? tmpdir(), "chain-family-partner-"));
    try {
      const root = process.cwd();
      const manifestPath = join(root, `tools/openclinxr/asset-pipeline/humanoid-chain/manifests/${actor}.post-export.json`);
      const input = join(dir, "pre.glb");
      const shipped = join(dir, "shipped.glb");
      const gitBlob = (rev: string) => execFileSync("git", ["show", `${rev}:${asset}`], { maxBuffer: 64 * 1024 * 1024 });
      const preImage = gitBlob("c613e86e8^");
      expect(sha256(preImage)).toBe(preImageSha);
      writeFileSync(input, preImage);
      writeFileSync(shipped, gitBlob("c613e86e8"));

      const tool = "tools/openclinxr/asset-pipeline/makeclothes/apply_hair_material_maps.py";
      const postExportRegistry = { ...POST_EXPORT_STAGE_REGISTRY };
      delete postExportRegistry[tool];
      const refused = join(dir, "refused");
      expect(() => {
        try {
          runChain({ root, manifestPath, input, out: refused, postExportRegistry });
        } catch (error) {
          console.info("P1 omitted registration:", (error as Error).message);
          throw error;
        }
      }).toThrow(`unregistered post-export tool: ${tool}`);
      expect(existsSync(refused)).toBe(false);

      const out = join(dir, "out");
      const started = performance.now();
      const report = runChain({ root, manifestPath, input, out });
      console.info(`P1 replay runtime: ${Math.round(performance.now() - started)} ms`);
      expect(report.status).toBe("complete");
      expect(report.stages).toMatchObject([{ id: "24", tool, inSha256: preImageSha }]);
      const result = hairEvidence(join(out, `${stageName}.glb`));
      const expected = hairEvidence(shipped);
      expect(result.material).toEqual(expected.material);
      expect(result.material).toEqual({
        name: materialName,
        doubleSided: true,
        pbrMetallicRoughness: { roughnessFactor: 0.98039, metallicFactor: 0, baseColorTexture: { index: 10 } },
        normalTexture: { index: 11 },
        alphaMode: "MASK",
        alphaCutoff: 0.2,
      });
      expect(result.textures.map(({ bytes, ...refs }) => ({ ...refs, sha256: sha256(bytes) }))).toEqual(
        expected.textures.map(({ bytes, ...refs }) => ({ ...refs, sha256: sha256(bytes) })),
      );
      expect(result.textures.map(({ bytes }) => sha256(bytes))).toEqual([
        "cf089d44bacecd763c330c151fce7606f05512481bd071aed42379e858606f20",
        "f0b761f31129ef5f808394a4f71b04e902fbd5eadfcad0f3ae0c8d89f87a73cb",
      ]);
      expect(result.textures.every(({ bytes }, index) => bytes.equals(expected.textures[index]!.bytes))).toBe(true);

      const record = JSON.parse(readFileSync(join(out, `${stageName}.provenance.json`), "utf8"));
      const prior = JSON.parse(readFileSync(join(out, ".inputs/pre.provenance.json"), "utf8"));
      expect(record.outputSha256).toBe(report.stages[0]!.outSha256);
      expect(record.byteLineage.recordedBefore).toEqual({
        outputSha256: preImageSha,
        outputBytes: preImage.length,
        byteLineage: prior.byteLineage,
      });
      expect(record.byteLineage.preImageSha256).toBe(preImageSha);
      expect(record.byteLineage.derivationArgv).toContain(tool);
      expect(record.byteLineage.stageRecord).toEqual({
        wiredMaterials: [{ materialName, texturesAdded: [10, 11] }],
      });
      console.info("P1 scratch sidecar stageRecord:", JSON.stringify(record.byteLineage.stageRecord));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("shipped kevin manifest (read-only validation, no stage runs)", () => {
  it("passes schema with 15 kept and 12 excluded stages", () => {
    const root = process.cwd();
    const raw = JSON.parse(
      readFileSync(join(root, "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-peds-nurse-kevin.json"), "utf8"),
    );
    const manifest = validateManifest(raw);
    expect(manifest.stages).toHaveLength(15);
    expect(manifest.excluded).toHaveLength(12);
    expect(manifest.stages.map((s) => s.id)).toEqual([
      "01", "03a", "04", "05", "08a", "08b",
      "10a", "10b", "10c", "12", "13", "17", "21", "22", "23",
    ]);
    for (const s of manifest.stages) {
      expect(existsSync(resolve(root, s.tool.split("#")[0] as string))).toBe(true);
    }
    const tens = manifest.stages.filter((s) => s.id.startsWith("10"));
    expect(tens).toHaveLength(3);
    for (const s of tens) {
      expect(s.inputs).toHaveLength(1);
      expect(s.inputs?.[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const nine = manifest.excluded.find((e) => e.id === "09");
    expect(nine?.reason).toBe("other");
    expect(nine?.note).toMatch(/06\/07 walk graft/);
    const fourteen = manifest.excluded.find((e) => e.id === "14");
    expect(fourteen?.reason).toBe("superseded");
    expect(fourteen?.note).toMatch(/MEAS3/);
    expect(fourteen?.note).toMatch(/4066911e4dfb/);
    const crc = manifest.excluded.find((e) => e.id === "03b");
    expect(crc?.reason).toBe("other");
    expect(crc?.name).toBe("albedo-bake-crc");
    expect(crc?.note).toMatch(/byte no-op/);
    expect(crc?.note).toMatch(/bcc4d219/);
    const four = manifest.stages.find((s) => s.id === "04");
    expect(four?.note).toBe("trousers kept undecimated via --face-preserving-keep library_scrub_pants (K2 R2)");
    const thirteen = manifest.stages.find((s) => s.id === "13");
    expect(thirteen?.note).toBe("--renormalize keeps the authored shirt albedo texels (K2 R3)");
    const twentyOne = manifest.stages.find((s) => s.id === "21");
    expect(twentyOne?.name).toBe("actor_hair_colour_post_export_v1");
    expect(twentyOne?.kind).toBe("python");
    expect(twentyOne?.tool).toBe("tools/openclinxr/asset-pipeline/makeclothes/apply_actor_hair_colour.py");
    expect(twentyOne?.argv.join(" ")).toContain("{in}");
    expect(twentyOne?.argv.join(" ")).toContain("{out}");
  });

  it("both shipped manifests validate (with10 + no-stage10)", () => {
    const root = process.cwd();
    const files = [
      "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-peds-nurse-kevin.json",
      "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-peds-nurse-kevin.no-stage10.json",
    ];
    const manifests = files.map((f) => validateManifest(JSON.parse(readFileSync(join(root, f), "utf8"))));
    expect(manifests[0].stages).toHaveLength(15);
    expect(manifests[0].excluded).toHaveLength(12);
    expect(manifests[1].stages).toHaveLength(12);
    expect(manifests[1].excluded).toHaveLength(15);
    expect(manifests[1].stages.map((s) => s.id)).toEqual([
      "01", "03a", "04", "05", "08a", "08b", "12", "13", "17", "21", "22", "23",
    ]);
    for (const m of manifests) {
      const nine = m.excluded.find((e) => e.id === "09");
      expect(nine?.reason).toBe("other");
      const fourteen = m.excluded.find((e) => e.id === "14");
      expect(fourteen?.reason).toBe("superseded");
      expect(fourteen?.note).toMatch(/4066911e4dfb/);
      const crc = m.excluded.find((e) => e.id === "03b");
      expect(crc?.reason).toBe("other");
      expect(crc?.note).toMatch(/no faithful input exists in this chain/);
      const four = m.stages.find((s) => s.id === "04");
      expect(four?.note).toBe("trousers kept undecimated via --face-preserving-keep library_scrub_pants (K2 R2)");
      const thirteen = m.stages.find((s) => s.id === "13");
      expect(thirteen?.note).toBe("--renormalize keeps the authored shirt albedo texels (K2 R3)");
    }
    const no10 = manifests[1];
    expect(no10.stages.map((s) => s.id)).not.toContain("10a");
    for (const id of ["10a", "10b", "10c"]) {
      const e = no10.excluded.find((x) => x.id === id);
      expect(e?.reason).toBe("superseded");
    }
  });
});

describe("shipped kevin stage 21 executes through runChain (kevin-colour h3 F1)", () => {
  const SHIPPED_MANIFEST =
    "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-peds-nurse-kevin.json";
  const STAGE_ID = "21";
  const STAGE_NAME = "actor_hair_colour_post_export_v1";
  const EXPECTED_LINEAR_RGB = [0.035, 0.028, 0.022];
  const SCENARIO = "kevin-colour-h3-test";
  const ACTOR = "test-actor";

  function shippedStage21(): ChainStage {
    const root = process.cwd();
    const manifest = validateManifest(JSON.parse(readFileSync(join(root, SHIPPED_MANIFEST), "utf8")));
    const stage = manifest.stages.find((s) => s.id === STAGE_ID);
    expect(stage, `shipped manifest carries stage ${STAGE_ID}`).toBeDefined();
    return stage as ChainStage;
  }

  /** Minimal GLB carrying exactly the scalp + brow materials the tool matches. */
  function minimalHairGlb(): Buffer {
    const doc = {
      asset: { version: "2.0" },
      materials: [
        { name: "openclinxr_fitted_hair_style08", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } },
        { name: "openclinxr_fitted_eyebrow_style08", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } },
      ],
    };
    const json = Buffer.from(JSON.stringify(doc), "utf8");
    const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
    const jc = Buffer.alloc(8);
    jc.writeUInt32LE(padded.length, 0);
    jc.writeUInt32LE(0x4e4f534a, 4);
    const bc = Buffer.alloc(8);
    bc.writeUInt32LE(0, 0);
    bc.writeUInt32LE(0x004e4942, 4);
    const total = 12 + 8 + padded.length + 8;
    const header = Buffer.alloc(12);
    header.write("glTF", 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(total, 8);
    return Buffer.concat([header, jc, padded, bc]);
  }

  function glbJson(raw: Buffer): { materials: { name: string; pbrMetallicRoughness: { baseColorFactor: number[] } }[] } {
    return JSON.parse(raw.subarray(20, 20 + raw.readUInt32LE(12)).toString("utf8")) as {
      materials: { name: string; pbrMetallicRoughness: { baseColorFactor: number[] } }[];
    };
  }

  function glbBin(raw: Buffer): Buffer {
    const h = 20 + raw.readUInt32LE(12);
    return Buffer.from(raw.subarray(h + 8, h + 8 + raw.readUInt32LE(h)));
  }

  function stage21Inputs(dir: string): { manifest: unknown[]; provenance: string; phenotypes: string } {
    const provenance = JSON.stringify({ scenarioId: SCENARIO, actorId: ACTOR });
    const phenotypes = JSON.stringify({ entries: { [SCENARIO]: { [ACTOR]: { phenotype: { hair_color: "black" } } } } });
    const provPath = join(dir, "pre.provenance.json");
    const phenPath = join(dir, "actor-phenotype.v1.json");
    writeFileSync(provPath, provenance);
    writeFileSync(phenPath, phenotypes);
    const shipped = shippedStage21();
    const manifest = [
      {
        id: STAGE_ID,
        name: STAGE_NAME,
        tool: shipped.tool,
        kind: shipped.kind,
        argv: shipped.argv,
        inputs: [
          { name: "pre.provenance.json", path: provPath, sha256: createHash("sha256").update(provenance).digest("hex") },
          { name: "actor-phenotype.v1.json", path: phenPath, sha256: createHash("sha256").update(phenotypes).digest("hex") },
        ],
      },
    ];
    return { manifest, provenance, phenotypes };
  }

  it("executes the stage-21-only manifest through runChain on a small GLB", { timeout: 60_000 }, () => {
    const root = process.cwd();
    const shipped = shippedStage21();
    expect(shipped.kind).toBe("python");
    expect(shipped.tool).toBe("tools/openclinxr/asset-pipeline/makeclothes/apply_actor_hair_colour.py");
    const dir = tmpRoot();
    const preGlb = join(dir, "pre.glb");
    writeFileSync(preGlb, minimalHairGlb());
    const { manifest } = stage21Inputs(dir);
    const manifestPath = writeManifest(dir, manifest);
    const out = join(dir, "out");
    const report = runChain({ manifestPath, input: preGlb, out, root });
    expect(report.status).toBe("complete");
    expect(report.stages).toHaveLength(1);
    const outGlbPath = join(out, `${STAGE_ID}-${STAGE_NAME}.glb`);
    expect(existsSync(outGlbPath), "stage 21 output GLB written").toBe(true);
    const outRaw = readFileSync(outGlbPath);
    const doc = glbJson(outRaw);
    expect(doc.materials).toHaveLength(2);
    for (const material of doc.materials) {
      expect(material.pbrMetallicRoughness.baseColorFactor).toEqual([...EXPECTED_LINEAR_RGB, 1]);
    }
    expect(glbBin(outRaw).equals(glbBin(readFileSync(preGlb))), "BIN chunk byte-identical").toBe(true);
    // The runner-recorded argv (written by runChain in chain-report.json after
    // real execution) equals the byteLineage-shaped argv: --glb {in},
    // --output {out}, provenance/phenotypes at the materialized .inputs paths.
    const outDir = resolve(out);
    const onDisk = JSON.parse(readFileSync(join(out, "chain-report.json"), "utf8")) as {
      stages: { argv: string[] }[];
    };
    expect(onDisk.stages[0]?.argv).toEqual([
      "--glb",
      resolve(preGlb),
      "--output",
      join(outDir, `.tmp-${STAGE_ID}-${STAGE_NAME}.glb`),
      "--provenance",
      join(outDir, ".inputs", "pre.provenance.json"),
      "--phenotypes",
      join(outDir, ".inputs", "actor-phenotype.v1.json"),
    ]);
  });

  it("counterweight: an altered declared-input hash fails through runChain materialization (RED)", { timeout: 60_000 }, () => {
    const root = process.cwd();
    const dir = tmpRoot();
    const preGlb = join(dir, "pre.glb");
    writeFileSync(preGlb, minimalHairGlb());
    const { manifest } = stage21Inputs(dir);
    const bad = JSON.parse(JSON.stringify(manifest)) as {
      inputs: { name: string; path: string; sha256: string }[];
    }[];
    const phen = bad[0]?.inputs.find((i) => i.name === "actor-phenotype.v1.json");
    expect(phen, "phenotype input declared").toBeDefined();
    phen!.sha256 = `${phen!.sha256.slice(0, 63)}${phen!.sha256.endsWith("0") ? "1" : "0"}`;
    const manifestPath = writeManifest(dir, bad);
    let caught: unknown;
    try {
      runChain({ manifestPath, input: preGlb, out: join(dir, "out-bad"), root });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/stage 21: input actor-phenotype\.v1\.json sha256/);
    expect((caught as Error).stack ?? "").toContain("run-chain");
  });
});

describe("shipped kevin stage 22 executes through runChain (kevin-collar S3)", () => {
  const SHIPPED_MANIFEST =
    "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-peds-nurse-kevin.json";
  const STAGE_ID = "22";
  const STAGE_NAME = "collar_sleeve_opening_unhide_v1";
  const SPEC_NAME = "neckline-sleeves.openings.json";
  const SELECT_NAME = "kevin-collar-select-126.json";

  /** Shipped stage-22 argv minus the --select-tris pair: the small opening
   * fixture below carries only 2 hidden tris (prim 0), so the real-kevin
   * SELECTED-126 list (prims 1/4/7, faces outside the fixture moved set)
   * would refuse; the openings-only path is what this fixture exercises. */
  function stripSelect(argv: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i += 1) {
      if (argv[i] === "--select-tris") {
        i += 1;
        continue;
      }
      out.push(argv[i] as string);
    }
    return out;
  }

  function shippedStage22(): ChainStage {
    const root = process.cwd();
    const manifest = validateManifest(JSON.parse(readFileSync(join(root, SHIPPED_MANIFEST), "utf8")));
    const stage = manifest.stages.find((s) => s.id === STAGE_ID);
    expect(stage, `shipped manifest carries stage ${STAGE_ID}`).toBeDefined();
    return stage as ChainStage;
  }

  /**
   * Minimal opening fixture: a 2-triangle hidden prim on a test body where
   * tri A sits above the shirt V-band floor with a clear +Z ray (moves to
   * skin) and tri B sits below the floor (kept, so no trim-empties refusal).
   * Front is +Z: the eyelash/teeth witnesses sit ahead of the neck skin.
   */
  function minimalOpeningGlb(): Buffer {
    const f32 = (xs: number[]): Buffer => {
      const b = Buffer.alloc(xs.length * 4);
      xs.forEach((v, i) => {
        b.writeFloatLE(v, i * 4);
      });
      return b;
    };
    const u32 = (xs: number[]): Buffer => {
      const b = Buffer.alloc(xs.length * 4);
      xs.forEach((v, i) => {
        b.writeUInt32LE(v, i * 4);
      });
      return b;
    };
    const chunks: { bytes: Buffer; componentType: number; type: string; count: number }[] = [];
    const push = (bytes: Buffer, componentType: number, type: string, count: number): number => {
      chunks.push({ bytes, componentType, type, count });
      return chunks.length - 1;
    };
    // Hidden prim: tri A above the band floor (moves), tri B below (kept).
    const hiddenPos = push(
      f32([0, 0.65, 0.4, 0.1, 0.65, 0.4, 0, 0.75, 0.4, 0, 0.2, 0.0, 0.1, 0.2, 0.0, 0, 0.3, 0.0]),
      5126, "VEC3", 6,
    );
    const hiddenNrm = push(f32([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 5126, "VEC3", 6);
    const hiddenIdx = push(u32([0, 1, 2, 3, 4, 5]), 5125, "SCALAR", 6);
    // Skin prim: one tri inside the neck column band below the shirt top.
    const skinPos = push(f32([0, 0.82, 0.05, 0.1, 0.82, 0.05, 0, 0.88, 0.05]), 5126, "VEC3", 3);
    const skinIdx = push(u32([0, 1, 2]), 5125, "SCALAR", 3);
    // Shirt: front panel z=0.3 (centre post at x=0 for the strip) + back z=0.1.
    const shirtPos = push(
      f32([
        -0.3, 0.5, 0.3, 0.3, 0.5, 0.3, -0.3, 0.9, 0.3, 0.3, 0.9, 0.3, 0, 0.5, 0.3, 0, 0.9, 0.3,
        -0.3, 0.5, 0.1, 0.3, 0.5, 0.1, -0.3, 0.9, 0.1, 0.3, 0.9, 0.1,
      ]),
      5126, "VEC3", 10,
    );
    const shirtIdx = push(u32([0, 4, 5, 0, 5, 2, 4, 1, 3, 4, 3, 5, 6, 7, 8, 7, 9, 8]), 5125, "SCALAR", 18);
    // Facial witnesses ahead of the neck skin (+Z front).
    const lashPos = push(f32([0, 1.3, 0.5, 0.05, 1.3, 0.5, 0, 1.35, 0.5]), 5126, "VEC3", 3);
    const lashIdx = push(u32([0, 1, 2]), 5125, "SCALAR", 3);
    const teethPos = push(f32([0, 1.25, 0.45, 0.05, 1.25, 0.45, 0, 1.3, 0.45]), 5126, "VEC3", 3);
    const teethIdx = push(u32([0, 1, 2]), 5125, "SCALAR", 3);
    const bufferViews: { buffer: number; byteOffset: number; byteLength: number }[] = [];
    const accessors: {
      bufferView: number; byteOffset: number; componentType: number; count: number; type: string;
    }[] = [];
    let byteOffset = 0;
    const parts: Buffer[] = [];
    for (const c of chunks) {
      bufferViews.push({ buffer: 0, byteOffset, byteLength: c.bytes.length });
      accessors.push({
        bufferView: bufferViews.length - 1, byteOffset: 0, componentType: c.componentType, count: c.count, type: c.type,
      });
      parts.push(c.bytes);
      byteOffset += c.bytes.length;
    }
    const doc = {
      asset: { version: "2.0" },
      materials: [{ name: "test_skin" }, { name: "openclinxr_hidden_upper_test_body_mesh" }, { name: "test_shirt" }],
      bufferViews,
      accessors,
      buffers: [{ byteLength: byteOffset }],
      meshes: [
        {
          name: "test_body",
          primitives: [
            { attributes: { POSITION: hiddenPos, NORMAL: hiddenNrm }, indices: hiddenIdx, material: 1 },
            { attributes: { POSITION: skinPos }, indices: skinIdx, material: 0 },
          ],
        },
        { name: "scrub_shirt", primitives: [{ attributes: { POSITION: shirtPos }, indices: shirtIdx, material: 2 }] },
        { name: "eyelash", primitives: [{ attributes: { POSITION: lashPos }, indices: lashIdx, material: 0 }] },
        {
          name: "fitted_teeth_mpfb",
          primitives: [{ attributes: { POSITION: teethPos }, indices: teethIdx, material: 0 }],
        },
      ],
    };
    const json = Buffer.from(JSON.stringify(doc), "utf8");
    const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
    const bin = Buffer.concat(parts);
    const jc = Buffer.alloc(8);
    jc.writeUInt32LE(padded.length, 0);
    jc.writeUInt32LE(0x4e4f534a, 4);
    const bc = Buffer.alloc(8);
    bc.writeUInt32LE(bin.length, 0);
    bc.writeUInt32LE(0x004e4942, 4);
    const total = 12 + 8 + padded.length + 8 + bin.length;
    const header = Buffer.alloc(12);
    header.write("glTF", 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(total, 8);
    return Buffer.concat([header, jc, padded, bc, bin]);
  }

  function glbDoc(raw: Buffer): {
    meshes: { name: string; primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
    accessors: { count: number; type: string }[];
  } {
    return JSON.parse(raw.subarray(20, 20 + raw.readUInt32LE(12)).toString("utf8")) as {
      meshes: { name: string; primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
      accessors: { count: number; type: string }[];
    };
  }

  function stage22Inputs(dir: string): { manifest: unknown[]; spec: string } {
    const spec = JSON.stringify({
      schemaVersion: "openclinxr.openings-spec.v1",
      openings: ["neckline", "sleeves"],
      edgeViews: ["front", "three_quarter"],
    });
    const specPath = join(dir, SPEC_NAME);
    writeFileSync(specPath, spec);
    const shipped = shippedStage22();
    const manifest = [
      {
        id: STAGE_ID,
        name: STAGE_NAME,
        tool: shipped.tool,
        kind: shipped.kind,
        argv: stripSelect(shipped.argv),
        inputs: [
          { name: SPEC_NAME, path: specPath, sha256: createHash("sha256").update(spec).digest("hex") },
        ],
      },
    ];
    return { manifest, spec };
  }

  it("executes the stage-22-only manifest through runChain on a small GLB", { timeout: 120_000 }, () => {
    const root = process.cwd();
    const shipped = shippedStage22();
    expect(shipped.kind).toBe("python");
    expect(shipped.tool).toBe("tools/openclinxr/asset-pipeline/makeclothes/unhide-neckline-opening.py");
    // B1: the shipped stage pins BOTH the openings spec and the
    // SELECTED-126 list as hash-pinned .inputs (proven by the real-input
    // replay below); the small fixture below exercises the openings-only
    // path with --select-tris stripped (see stripSelect).
    expect(shipped.inputs?.map((i) => i.name).sort()).toEqual([SELECT_NAME, SPEC_NAME].sort());
    const selectInput = shipped.inputs?.find((i) => i.name === SELECT_NAME);
    const selectionPath = "tools/openclinxr/asset-pipeline/makeclothes/openings/kevin-collar-select-126.json";
    expect(selectInput?.path).toBe(selectionPath);
    expect(selectInput?.sha256).toBe(createHash("sha256").update(readFileSync(join(root, selectionPath))).digest("hex"));
    expect(shipped.argv).toContain("--select-tris");
    const dir = tmpRoot();
    const preGlb = join(dir, "pre.glb");
    writeFileSync(preGlb, minimalOpeningGlb());
    const { manifest } = stage22Inputs(dir);
    const manifestPath = writeManifest(dir, manifest);
    const out = join(dir, "out");
    const report = runChain({ manifestPath, input: preGlb, out, root });
    expect(report.status).toBe("complete");
    expect(report.stages).toHaveLength(1);
    const outGlbPath = join(out, `${STAGE_ID}-${STAGE_NAME}.glb`);
    expect(existsSync(outGlbPath), "stage 22 output GLB written").toBe(true);
    // Tri A (above the band floor) moved to a new skin prim; tri B kept.
    const outDoc = glbDoc(readFileSync(outGlbPath));
    const body = outDoc.meshes.find((m) => m.name === "test_body");
    expect(body, "test body mesh survives").toBeDefined();
    expect(body!.primitives).toHaveLength(3);
    const hiddenPrim = body!.primitives[0];
    expect(outDoc.accessors[hiddenPrim?.indices ?? -1]?.count, "hidden prim trimmed to tri B").toBe(3);
    const fresh = body!.primitives[2];
    expect(fresh?.material).toBe(0);
    expect(outDoc.accessors[fresh?.indices ?? -1]?.count, "new skin prim carries tri A").toBe(3);
    // The tool report at {outdir} records the neckline+sleeves openings.
    const toolReport = JSON.parse(
      readFileSync(join(out, "22-collar-sleeve-opening-unhide.json"), "utf8"),
    ) as { movedTrisTotal: number; openings: string[]; primitives: { baseMovedTris: number; edgeMovedTris: number }[] };
    expect(toolReport.movedTrisTotal).toBe(1);
    expect(toolReport.openings).toEqual(["neckline", "sleeves"]);
    expect(toolReport.primitives[0]?.baseMovedTris).toBe(1);
    // The runner-recorded argv resolves the pinned spec through .inputs.
    const outDir = resolve(out);
    const onDisk = JSON.parse(readFileSync(join(out, "chain-report.json"), "utf8")) as {
      stages: { argv: string[] }[];
    };
    expect(onDisk.stages[0]?.argv).toEqual([
      "--in",
      resolve(preGlb),
      "--output",
      join(outDir, `.tmp-${STAGE_ID}-${STAGE_NAME}.glb`),
      "--report",
      join(outDir, "22-collar-sleeve-opening-unhide.json"),
      "--openings-spec",
      join(outDir, ".inputs", SPEC_NAME),
    ]);
  });

  it("counterweight: an altered spec hash fails through runChain materialization (RED)", { timeout: 60_000 }, () => {
    const dir = tmpRoot();
    const preGlb = join(dir, "pre.glb");
    writeFileSync(preGlb, minimalOpeningGlb());
    const { manifest } = stage22Inputs(dir);
    const bad = JSON.parse(JSON.stringify(manifest)) as {
      inputs: { name: string; path: string; sha256: string }[];
    }[];
    const spec = bad[0]?.inputs.find((i) => i.name === SPEC_NAME);
    expect(spec, "openings spec input declared").toBeDefined();
    spec!.sha256 = `${spec!.sha256.slice(0, 63)}${spec!.sha256.endsWith("0") ? "1" : "0"}`;
    const manifestPath = writeManifest(dir, bad);
    let caught: unknown;
    try {
      runChain({ manifestPath, input: preGlb, out: join(dir, "out-bad"), root: process.cwd() });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/stage 22: input neckline-sleeves\.openings\.json sha256/);
    expect((caught as Error).stack ?? "").toContain("run-chain");
  });
});

describe("shipped kevin stages 22+23 replay on the real pre-fix input (kevin-collar S9/B1)", () => {
  const SHIPPED_MANIFEST =
    "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-peds-nurse-kevin.json";
  const KEVIN_PRE_REF =
    "8108f27c0:apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb";
  const KEVIN_PRE_SHA = "4049295125a11dc398457701dfe3a55c8fd47d784dfeaed99e5e3e3ba3b92c72";
  const KEVIN_SHIPPED = "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb";
  const PHYS_PRE_REF =
    "399ae1f8f~1:apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb";
  const PHYS_PRE_SHA = "2faef74ab1ed20a155f992c8e8f79f8229cedab7cf3dd511317d1e333b3860e0";
  const PHYS_POST_SHA = "8c3ab05cf2da84c5af223bc16219bc6ac14c2701acc3e50eb674b9a4e26c878f";

  function shippedStage(id: string): ChainStage {
    const root = process.cwd();
    const manifest = validateManifest(JSON.parse(readFileSync(join(root, SHIPPED_MANIFEST), "utf8")));
    const stage = manifest.stages.find((s) => s.id === id);
    expect(stage, `shipped manifest carries stage ${id}`).toBeDefined();
    return stage as ChainStage;
  }

  function gitBytes(ref: string): Buffer {
    const raw = execFileSync("git", ["-C", process.cwd(), "show", ref], { maxBuffer: 512 * 1024 * 1024 });
    return raw as Buffer;
  }

  function dropFlag(argv: string[], flag: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i += 1) {
      if (argv[i] === flag) {
        i += 1;
        continue;
      }
      out.push(argv[i] as string);
    }
    return out;
  }

  it("replays stages 22+23 on the real pre-fix input: moves 126 tris and reproduces the tracked GLB", { timeout: 900_000 }, () => {
    const root = process.cwd();
    const preBytes = gitBytes(KEVIN_PRE_REF);
    expect(createHash("sha256").update(preBytes).digest("hex"), "pre-fix pin is 40492951").toBe(KEVIN_PRE_SHA);
    const dir = tmpRoot();
    const preGlb = join(dir, "pre.glb");
    writeFileSync(preGlb, preBytes);
    const s22 = shippedStage("22");
    const s23 = shippedStage("23");
    // The manifest pins BOTH writers (kevin.json + no-stage10.json carry
    // the identical stage-22 argv/inputs); assert the no-stage10 writer too.
    const altRaw = JSON.parse(
      readFileSync(join(root, "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-peds-nurse-kevin.no-stage10.json"), "utf8"),
    );
    const altManifest = validateManifest(altRaw);
    const alt22 = altManifest.stages.find((s) => s.id === "22");
    expect(alt22, "no-stage10 manifest carries stage 22").toBeDefined();
    expect(alt22!.argv).toEqual(s22.argv);
    expect(alt22!.inputs).toEqual(s22.inputs);
    const manifest = [
      { id: s22.id, name: s22.name, tool: s22.tool, kind: s22.kind, argv: s22.argv, inputs: s22.inputs },
      { id: s23.id, name: s23.name, tool: s23.tool, kind: s23.kind, argv: s23.argv, inputs: s23.inputs },
    ];
    const manifestPath = writeManifest(dir, manifest);
    const out = join(dir, "out");
    const report = runChain({ manifestPath, input: preGlb, out, root });
    expect(report.status).toBe("complete");
    expect(report.stages).toHaveLength(2);
    const toolReport = JSON.parse(readFileSync(join(out, "22-collar-sleeve-opening-unhide.json"), "utf8")) as {
      movedTrisTotal: number;
      selectKeptTrisTotal?: number;
    };
    expect(toolReport.movedTrisTotal, "SELECTED-126 moves exactly 126 tris").toBe(126);
    const finalGlb = join(out, `23-${s23.name}.glb`);
    const finalSha = createHash("sha256").update(readFileSync(finalGlb)).digest("hex");
    const trackedSha = createHash("sha256").update(readFileSync(join(root, KEVIN_SHIPPED))).digest("hex");
    expect(finalSha, "chain replay reproduces the tracked Kevin GLB bytes").toBe(trackedSha);
    // eslint-disable-next-line no-console
    console.log(`Tests: B1 replay GREEN: movedTrisTotal=126 final sha=${finalSha} (tracked ${trackedSha})`);
  });

  it("counterweight: replay with --select-tris omitted differs from the tracked GLB (RED)", { timeout: 900_000 }, () => {
    const root = process.cwd();
    const preBytes = gitBytes(KEVIN_PRE_REF);
    expect(createHash("sha256").update(preBytes).digest("hex")).toBe(KEVIN_PRE_SHA);
    const dir = tmpRoot();
    const preGlb = join(dir, "pre.glb");
    writeFileSync(preGlb, preBytes);
    const s22 = shippedStage("22");
    const s23 = shippedStage("23");
    const s22NoSelect = {
      id: s22.id,
      name: s22.name,
      tool: s22.tool,
      kind: s22.kind,
      argv: dropFlag(s22.argv, "--select-tris"),
      inputs: (s22.inputs ?? []).filter((i) => i.name !== "kevin-collar-select-126.json"),
    };
    const manifest = [
      s22NoSelect,
      { id: s23.id, name: s23.name, tool: s23.tool, kind: s23.kind, argv: s23.argv, inputs: s23.inputs },
    ];
    const manifestPath = writeManifest(dir, manifest);
    const out = join(dir, "out-noselect");
    const report = runChain({ manifestPath, input: preGlb, out, root });
    expect(report.status).toBe("complete");
    const toolReport = JSON.parse(readFileSync(join(out, "22-collar-sleeve-opening-unhide.json"), "utf8")) as {
      movedTrisTotal: number;
    };
    const finalSha = createHash("sha256").update(readFileSync(join(out, `23-${s23.name}.glb`))).digest("hex");
    const trackedSha = createHash("sha256").update(readFileSync(join(root, KEVIN_SHIPPED))).digest("hex");
    // eslint-disable-next-line no-console
    console.log(`Tests: B1 counterweight RED as required: no-select movedTrisTotal=${toolReport.movedTrisTotal} final sha=${finalSha} (tracked ${trackedSha})`);
    expect(toolReport.movedTrisTotal, "un-narrowed moved set is not the SELECTED 126").not.toBe(126);
    expect(finalSha, "omitting --select-tris must change the tracked replay bytes").not.toBe(trackedSha);
  });

  it("physician default path stays byte-equal (2faef74a -> 8c3ab05c)", { timeout: 900_000 }, () => {
    const preBytes = gitBytes(PHYS_PRE_REF);
    expect(createHash("sha256").update(preBytes).digest("hex"), "physician pre-image pin is 2faef74a").toBe(PHYS_PRE_SHA);
    const dir = tmpRoot();
    const preGlb = join(dir, "phys-pre.glb");
    writeFileSync(preGlb, preBytes);
    const s22 = shippedStage("22");
    // Legacy default path: no --openings-spec and no --select-tris.
    const legacy = {
      id: s22.id,
      name: s22.name,
      tool: s22.tool,
      kind: s22.kind,
      argv: dropFlag(dropFlag(s22.argv, "--openings-spec"), "--select-tris"),
      inputs: [],
    };
    const manifestPath = writeManifest(dir, [legacy]);
    const out = join(dir, "out-phys");
    const report = runChain({ manifestPath, input: preGlb, out, root: process.cwd() });
    expect(report.status).toBe("complete");
    const outSha = createHash("sha256").update(readFileSync(join(out, `22-${s22.name}.glb`))).digest("hex");
    // eslint-disable-next-line no-console
    console.log(`Tests: physician default path GREEN: 2faef74a -> ${outSha} (want ${PHYS_POST_SHA})`);
    expect(outSha, "default path reproduces the physician 8c3ab05c bytes").toBe(PHYS_POST_SHA);
  });
});

function preImageLookupDecision(catFileStatus: number | null, shallowFlag: string): "replay" | "skip" | "fail" {
  if (catFileStatus === 0) return "replay";
  return shallowFlag === "true" ? "skip" : "fail";
}

function kevinPreImageSkipReason(revision: string, catFileStatus: number | null, shallowFlag: string): string | undefined {
  switch (preImageLookupDecision(catFileStatus, shallowFlag)) {
    case "replay": return undefined;
    case "skip": return `Kevin pre-image revision ${revision} not found in a shallow repository`;
    case "fail": throw new Error(`Kevin pre-image revision ${revision} not found in a full clone`);
  }
}

describe("Kevin sidecar replay and plants", () => {
  const S9_DRIVER = "tools/openclinxr/evidence/skin-footprint-inpaint/scripts/kevin-collar-s9-chain.py";
  const KEVIN_ASSET = "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin";

  it("(lin) fails a mistyped revision in a full clone and skips it in a shallow repository", () => {
    const revision = "0000000deadbeef";
    const gitObject = spawnSync("git", ["cat-file", "-e", `${revision}^{commit}`], { encoding: "utf8" });
    if (gitObject.error) throw gitObject.error;
    expect(gitObject.status).not.toBe(0);

    const fullCloneLookup = () => kevinPreImageSkipReason(revision, gitObject.status, "false");
    const failure = `Kevin pre-image revision ${revision} not found in a full clone`;
    expect(fullCloneLookup).toThrow(failure);
    console.log(`(lin) typo plant FAIL: ${failure}`);

    expect(preImageLookupDecision(gitObject.status, "true")).toBe("skip");
    const skip = kevinPreImageSkipReason(revision, gitObject.status, "true");
    expect(skip).toBe(`Kevin pre-image revision ${revision} not found in a shallow repository`);
    console.log(`(lin) shallow plant SKIP: ${skip}`);
  });

  it("(lin) replays the newest Kevin sidecar derivation byte-identical to the installed GLB", { timeout: 300_000 }, (ctx) => {
    const { byteLineage } = JSON.parse(readFileSync(`${KEVIN_ASSET}.provenance.json`, "utf8")) as {
      byteLineage: { preImageRevision: string; preImageSha256: string; derivationArgv: string[] };
    };
    const { preImageRevision, preImageSha256, derivationArgv } = byteLineage;
    console.log(`(lin) byteLineage.derivationArgv=${JSON.stringify(derivationArgv)}`);
    expect(derivationArgv).toContain(S9_DRIVER);

    const [revision] = preImageRevision.split(":");
    const gitObject = spawnSync("git", ["cat-file", "-e", `${revision}^{commit}`], { encoding: "utf8" });
    if (gitObject.error) throw gitObject.error;
    if (gitObject.status !== 0) {
      const shallowFlag = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
        encoding: "utf8",
      }).replace(/\r?\n$/, "");
      const reason = kevinPreImageSkipReason(revision, gitObject.status, shallowFlag);
      if (reason !== undefined) {
        console.log(`(lin) SKIP: ${reason}`);
        ctx.skip(reason);
      }
    }

    const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    const installedSha = sha(readFileSync(`${KEVIN_ASSET}.glb`));
    const assertInstalledSha = (outputSha: string) =>
      expect(outputSha, "replayed Kevin GLB SHA-256").toBe(installedSha);
    const work = tmpRoot();
    try {
      const pre = join(work, "pre.glb");
      const out = join(work, "out.glb");
      const report = join(work, "report.json");
      const preBytes = execFileSync("git", ["show", preImageRevision], { maxBuffer: 256 * 1024 * 1024 });
      expect(sha(preBytes), "git pre-image SHA-256").toBe(preImageSha256);
      writeFileSync(pre, preBytes);
      const [command, ...args] = derivationArgv.map((token) =>
        token.replace("{pre}", pre).replace("{out}", out).replace("{report}", report),
      );
      const options = { env: { ...process.env, TMPDIR: work }, encoding: "utf8" } as const;

      const missingPre = join(work, "missing-pre.glb");
      const plantedArgs = args.map((arg) => (arg === pre ? missingPre : arg));
      console.log(`(lin) plant argv before=${pre} after=${missingPre}`);
      const planted = spawnSync(command, plantedArgs, options);
      if (planted.error) throw planted.error;
      expect(planted.status).toBe(1);
      expect(planted.stdout).toContain("chain stage22-unhide-select refused");
      expect(planted.stderr).toContain(`FileNotFoundError: [Errno 2] No such file or directory: '${missingPre}'`);
      console.log("(lin) plant argv RED: stage22-unhide-select refused the missing pre-image");

      execFileSync(command, args, { ...options, stdio: "pipe" });
      const output = readFileSync(out);
      const flipped = Buffer.from(output);
      flipped[0] ^= 1;
      const outputSha = sha(output);
      const flippedSha = sha(flipped);
      console.log(`(lin) plant output SHA before=${outputSha} after=${flippedSha}`);
      expect(() => assertInstalledSha(flippedSha)).toThrow(/replayed Kevin GLB SHA-256/);
      console.log("(lin) plant output RED: replayed Kevin GLB SHA-256 assertion rejected the flipped byte");

      assertInstalledSha(outputSha);
      console.log(`(lin) GREEN: sidecar derivation reproduces installed GLB SHA-256 ${outputSha}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe("shipped kevin stage 23 executes through runChain (kevin-collar S5)", () => {
  const SHIPPED_MANIFEST =
    "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-peds-nurse-kevin.json";
  const STAGE_ID = "23";
  const STAGE_NAME = "collar_sleeve_skin_footprint_inpaint_v1";
  const MASK_NAME = "kevin-openings-footprint-mask.png";

  function shippedStage23(): ChainStage {
    const root = process.cwd();
    const manifest = validateManifest(JSON.parse(readFileSync(join(root, SHIPPED_MANIFEST), "utf8")));
    const stage = manifest.stages.find((s) => s.id === STAGE_ID);
    expect(stage, `shipped manifest carries stage ${STAGE_ID}`).toBeDefined();
    return stage as ChainStage;
  }

  it("carries the pinned footprint mask as a hash-pinned input", () => {
    const shipped = shippedStage23();
    expect(shipped.kind).toBe("python");
    expect(shipped.tool).toBe("tools/openclinxr/evidence/skin-footprint-inpaint/inpaint_hide_footprint.py");
    expect(shipped.inputs).toHaveLength(1);
    expect(shipped.inputs?.[0]?.name).toBe(MASK_NAME);
    const maskPath = "tools/openclinxr/evidence/skin-footprint-inpaint/fixtures/kevin-openings-footprint-mask.png";
    expect(shipped.inputs?.[0]?.path).toBe(maskPath);
    expect(shipped.inputs?.[0]?.sha256).toBe(
      createHash("sha256").update(readFileSync(join(process.cwd(), maskPath))).digest("hex"),
    );
    expect(shipped.argv.join(" ")).toContain("{outdir}/.inputs/kevin-openings-footprint-mask.png");
  });

  it("counterweight: an altered mask hash fails through runChain materialization (RED)", { timeout: 60_000 }, () => {
    const dir = tmpRoot();
    const preGlb = join(dir, "pre.glb");
    writeFileSync(preGlb, Buffer.from("GLB0", "utf8"));
    const shipped = shippedStage23();
    const manifest = [
      {
        id: STAGE_ID,
        name: STAGE_NAME,
        tool: shipped.tool,
        kind: shipped.kind,
        argv: shipped.argv,
        inputs: [
          {
            name: MASK_NAME,
            path: join(dir, MASK_NAME),
            sha256: createHash("sha256").update("mask-bytes").digest("hex"),
          },
        ],
      },
    ];
    writeFileSync(join(dir, MASK_NAME), "mask-bytes");
    const bad = JSON.parse(JSON.stringify(manifest)) as {
      inputs: { name: string; path: string; sha256: string }[];
    }[];
    const mask = bad[0]?.inputs.find((i) => i.name === MASK_NAME);
    expect(mask, "footprint mask input declared").toBeDefined();
    mask!.sha256 = `${mask!.sha256.slice(0, 63)}${mask!.sha256.endsWith("0") ? "1" : "0"}`;
    const manifestPath = writeManifest(dir, bad);
    let caught: unknown;
    try {
      runChain({ manifestPath, input: preGlb, out: join(dir, "out-bad"), root: process.cwd() });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/stage 23: input kevin-openings-footprint-mask\.png sha256/);
    expect((caught as Error).stack ?? "").toContain("run-chain");
  });

  /**
   * Minimal inpaint fixture: a 32x32 skin PNG (warm-grey island, black 4x4
   * hole) embedded in a one-prim mpfb_test_body GLB, plus a 32x32 mask PNG
   * covering exactly the hole. Proves the shipped stage-23 argv executes
   * through runChain and fills the hole from the island's own texels
   * (afterBlackFrac 1.0 -> 0.0, off-footprint bytes preserved by the tool's
   * own offFootprintHash round-trip on the real asset in P4).
   */
  let CRC_TABLE_LOCAL: Uint32Array | null = null;
  function crc32Local(bytes: Uint8Array): number {
    if (!CRC_TABLE_LOCAL) {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
      }
      CRC_TABLE_LOCAL = t;
    }
    const t = CRC_TABLE_LOCAL;
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) c = t[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function pngChunkLocal(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32Local(out.subarray(4, 8 + data.length)));
    return out;
  }
  function encodePngRgbLocal(w: number, h: number, rgb: Uint8Array): Buffer {
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w);
    dv.setUint32(4, h);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y += 1) {
      raw[y * (w * 3 + 1)] = 0;
      Buffer.from(rgb.subarray(y * w * 3, (y + 1) * w * 3)).copy(raw, y * (w * 3 + 1) + 1);
    }
    const idat = deflateSync(raw);
    const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    return Buffer.concat([sig, pngChunkLocal("IHDR", ihdr), pngChunkLocal("IDAT", new Uint8Array(idat)), pngChunkLocal("IEND", new Uint8Array(0))]);
  }
  function minimalInpaintGlb(skinPng: Buffer): Buffer {
    const f32 = (xs: number[]): Buffer => {
      const b = Buffer.alloc(xs.length * 4);
      xs.forEach((v, i) => {
        b.writeFloatLE(v, i * 4);
      });
      return b;
    };
    const u32 = (xs: number[]): Buffer => {
      const b = Buffer.alloc(xs.length * 4);
      xs.forEach((v, i) => {
        b.writeUInt32LE(v, i * 4);
      });
      return b;
    };
    // Quad UVs covering texels x,y in [8,24) of the 32x32 skin image.
    const pos = f32([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    const uv = f32([8 / 32, 8 / 32, 24 / 32, 8 / 32, 24 / 32, 24 / 32, 8 / 32, 24 / 32]);
    const idx = u32([0, 1, 2, 0, 2, 3]);
    const chunks: { bytes: Buffer; componentType: number; type: string; count: number }[] = [];
    const push = (bytes: Buffer, componentType: number, type: string, count: number): number => {
      chunks.push({ bytes, componentType, type, count });
      return chunks.length - 1;
    };
    const posA = push(pos, 5126, "VEC3", 4);
    const uvA = push(uv, 5126, "VEC2", 4);
    const idxA = push(idx, 5125, "SCALAR", 6);
    const pngPadded = Buffer.concat([skinPng, Buffer.alloc((4 - (skinPng.length % 4)) % 4, 0)]);
    const _imgA = push(pngPadded, 5121, "SCALAR", pngPadded.length);
    const bufferViews: { buffer: number; byteOffset: number; byteLength: number }[] = [];
    const accessors: { bufferView: number; byteOffset: number; componentType: number; count: number; type: string }[] = [];
    let byteOffset = 0;
    const parts: Buffer[] = [];
    for (const c of chunks) {
      bufferViews.push({ buffer: 0, byteOffset, byteLength: c.bytes.length });
      accessors.push({
        bufferView: bufferViews.length - 1, byteOffset: 0, componentType: c.componentType, count: c.count, type: c.type,
      });
      parts.push(c.bytes);
      byteOffset += c.bytes.length;
    }
    const doc = {
      asset: { version: "2.0" },
      materials: [{ name: "mpfb_skin_test", pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{ source: 0 }],
      images: [{ bufferView: 3, mimeType: "image/png", name: "mpfb-test.skin" }],
      bufferViews,
      accessors,
      buffers: [{ byteLength: byteOffset }],
      meshes: [
        {
          name: "mpfb_test_body",
          primitives: [{ attributes: { POSITION: posA, TEXCOORD_0: uvA }, indices: idxA, material: 0 }],
        },
      ],
    };
    const json = Buffer.from(JSON.stringify(doc), "utf8");
    const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
    const bin = Buffer.concat(parts);
    const jc = Buffer.alloc(8);
    jc.writeUInt32LE(padded.length, 0);
    jc.writeUInt32LE(0x4e4f534a, 4);
    const bc = Buffer.alloc(8);
    bc.writeUInt32LE(bin.length, 0);
    bc.writeUInt32LE(0x004e4942, 4);
    const total = 12 + 8 + padded.length + 8 + bin.length;
    const header = Buffer.alloc(12);
    header.write("glTF", 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(total, 8);
    return Buffer.concat([header, jc, padded, bc, bin]);
  }

  it("executes the stage-23-only manifest through runChain on a small GLB", { timeout: 120_000 }, () => {
    const root = process.cwd();
    const shipped = shippedStage23();
    expect(shipped.kind).toBe("python");
    expect(shipped.tool).toBe("tools/openclinxr/evidence/skin-footprint-inpaint/inpaint_hide_footprint.py");
    const dir = tmpRoot();
    // Skin image: warm grey island (texels [8,24)^2), black 4x4 hole at
    // rows/cols 14..17, dark surround outside the island (untouched).
    const W = 32;
    const H = 32;
    const rgb = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const inIsland = x >= 8 && x < 24 && y >= 8 && y < 24;
        const inHole = x >= 14 && x < 18 && y >= 14 && y < 18;
        const v: [number, number, number] = !inIsland ? [10, 10, 10] : inHole ? [0, 0, 0] : [185, 155, 140];
        rgb.set(v, (y * W + x) * 3);
      }
    }
    const skinPng = encodePngRgbLocal(W, H, rgb);
    const preGlb = join(dir, "pre.glb");
    writeFileSync(preGlb, minimalInpaintGlb(skinPng));
    // Mask: exactly the 4x4 hole, strictly inside the island.
    const mrgb = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const v: [number, number, number] = x >= 14 && x < 18 && y >= 14 && y < 18 ? [255, 255, 255] : [0, 0, 0];
        mrgb.set(v, (y * W + x) * 3);
      }
    }
    const maskPath = join(dir, MASK_NAME);
    writeFileSync(maskPath, encodePngRgbLocal(W, H, mrgb));
    const manifest = [
      {
        id: STAGE_ID,
        name: STAGE_NAME,
        tool: shipped.tool,
        kind: shipped.kind,
        argv: shipped.argv,
        inputs: [
          { name: MASK_NAME, path: maskPath, sha256: createHash("sha256").update(readFileSync(maskPath)).digest("hex") },
        ],
      },
    ];
    const manifestPath = writeManifest(dir, manifest);
    const out = join(dir, "out");
    const report = runChain({ manifestPath, input: preGlb, out, root });
    expect(report.status).toBe("complete");
    expect(report.stages).toHaveLength(1);
    const outGlbPath = join(out, `${STAGE_ID}-${STAGE_NAME}.glb`);
    expect(existsSync(outGlbPath), "stage 23 output GLB written").toBe(true);
    const toolReport = JSON.parse(
      readFileSync(join(out, "23-collar-sleeve-skin-footprint-inpaint.json"), "utf8"),
    ) as { footprintTexels: number; beforeBlackFrac: number; afterBlackFrac: number; islandsTouched: number[]; islandCount: number };
    expect(toolReport.footprintTexels).toBe(16);
    expect(toolReport.beforeBlackFrac).toBe(1);
    expect(toolReport.afterBlackFrac).toBe(0);
    expect(toolReport.islandsTouched).toEqual([1]);
    expect(toolReport.islandCount).toBe(1);
    const outDir = resolve(out);
    const onDisk = JSON.parse(readFileSync(join(out, "chain-report.json"), "utf8")) as {
      stages: { argv: string[] }[];
    };
    expect(onDisk.stages[0]?.argv).toEqual([
      "--in",
      resolve(preGlb),
      "--out",
      join(outDir, `.tmp-${STAGE_ID}-${STAGE_NAME}.glb`),
      "--footprint-mask",
      join(outDir, ".inputs", MASK_NAME),
      "--report",
      join(outDir, "23-collar-sleeve-skin-footprint-inpaint.json"),
    ]);
  });

  it("counterweight: a dropped mask input fails through runChain (RED)", { timeout: 120_000 }, () => {
    const dir = tmpRoot();
    const rgb = new Uint8Array(32 * 32 * 3).fill(128);
    const preGlb = join(dir, "pre.glb");
    writeFileSync(preGlb, minimalInpaintGlb(encodePngRgbLocal(32, 32, rgb)));
    const shipped = shippedStage23();
    const manifest = [
      {
        id: STAGE_ID,
        name: STAGE_NAME,
        tool: shipped.tool,
        kind: shipped.kind,
        argv: shipped.argv,
        inputs: [],
      },
    ];
    const manifestPath = writeManifest(dir, manifest);
    let caught: unknown;
    try {
      runChain({ manifestPath, input: preGlb, out: join(dir, "out-bad"), root: process.cwd() });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });
});
describe("runChain", () => {
  // CI 44195741094 measured 5.7 s max; x3 ≈ 20 s
  it("runs two fake stages in order and writes the chain report", { timeout: 20_000 }, () => {
    const dir = tmpRoot();
    const manifest = writeManifest(dir, twoStageManifest());
    const out = join(dir, "out");
    const report = runChain({ manifestPath: manifest, input: writeInput(dir), out });
    expect(report.stages.map((s) => s.id)).toEqual(["01", "02"]);
    const final = readFileSync(join(out, "02-second.glb"), "utf8");
    expect(final).toBe("GLB0AB");
    const onDisk = JSON.parse(readFileSync(join(out, "chain-report.json"), "utf8"));
    expect(onDisk.actorId).toBe("test-actor");
    expect(onDisk.stages).toHaveLength(2);
    for (const s of onDisk.stages) {
      expect(s.toolSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.inSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.outSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Array.isArray(s.argv)).toBe(true);
      expect(s.argv.join(" ")).not.toMatch(/[{}]/);
    }
    expect(onDisk.stages[0].outSha256).toBe(onDisk.stages[1].inSha256);
    expect(onDisk.status).toBe("complete");
    expect(onDisk.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(onDisk.excluded).toEqual([]);
    expect(onDisk.claimScope).toBe(CHAIN_CLAIM_SCOPE);
    expect(onDisk.claimScope).toBe("replays the kept post-materialize stages of this manifest only");
    expect(onDisk.notEvidenceFor).toEqual(CHAIN_NOT_EVIDENCE_FOR);
    expect(onDisk.notEvidenceFor).toEqual([
      "full historical reproduction",
      "visual acceptance",
      "clinical validity",
      "Quest readiness",
      "promotion",
    ]);
  });

  // CI 44195741094 measured 5.7 s max; x3 ≈ 20 s
  it("refuses to overwrite write-once stage outputs", { timeout: 20_000 }, () => {
    const dir = tmpRoot();
    const manifest = writeManifest(dir, twoStageManifest());
    const input = writeInput(dir);
    const out = join(dir, "out");
    runChain({ manifestPath: manifest, input, out });
    expect(() => runChain({ manifestPath: manifest, input, out })).toThrow(/write-once/);
  });

  // CI 44195741094 measured 5.7 s max; x3 ≈ 20 s
  it("refuses a pre-existing out directory even when empty and writes nothing", { timeout: 20_000 }, () => {
    const dir = tmpRoot();
    const manifest = writeManifest(dir, twoStageManifest());
    const input = writeInput(dir);
    const out = join(dir, "out");
    mkdirSync(out);
    expect(() => runChain({ manifestPath: manifest, input, out })).toThrow(/write-once/);
    expect(existsSync(join(out, "chain-report.json"))).toBe(false);
    expect(existsSync(join(out, "01-first.glb"))).toBe(false);
  });

  // CI 44195741094 measured 5.7 s max; x3 ≈ 20 s
  it("a failing in-place stage leaves no final-named GLB and writes a failed report", { timeout: 20_000 }, () => {
    const dir = tmpRoot();
    const manifest = writeManifest(dir, [
      {
        id: "01",
        name: "boom",
        tool: FAKE_FAIL,
        kind: "node",
        argv: ["{out}"],
      },
    ]);
    const out = join(dir, "out");
    expect(() => runChain({ manifestPath: manifest, input: writeInput(dir), out })).toThrow();
    expect(existsSync(join(out, "01-boom.glb"))).toBe(false);
    expect(existsSync(join(out, ".tmp-01-boom.glb"))).toBe(false);
    const onDisk = JSON.parse(readFileSync(join(out, "chain-report.json"), "utf8"));
    expect(onDisk.status).toBe("failed");
    expect(onDisk.failedStage).toBe("01");
    expect(typeof onDisk.error).toBe("string");
    expect(onDisk.error.length).toBeGreaterThan(0);
    expect(onDisk.stages).toEqual([]);
    expect(onDisk.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(onDisk.claimScope).toBe(CHAIN_CLAIM_SCOPE);
    expect(onDisk.notEvidenceFor).toEqual(CHAIN_NOT_EVIDENCE_FOR);
  });

  // CI 44195741094 measured 5.7 s max; x3 ≈ 20 s
  it("collects a workdir product via collectFrom", { timeout: 20_000 }, () => {
    const dir = tmpRoot();
    const manifest = writeManifest(dir, [
      {
        id: "01",
        name: "baked",
        tool: FAKE_WORKDIR,
        kind: "node",
        argv: ["--input", "{in}", "--workfile", "{outdir}/.work/{inBase}.glb"],
        collectFrom: "{outdir}/.work/{inBase}.glb",
      },
    ]);
    const out = join(dir, "out");
    runChain({ manifestPath: manifest, input: writeInput(dir), out });
    expect(readFileSync(join(out, "01-baked.glb"), "utf8")).toBe("GLB0+W");
  });

  // CI 44195741094 measured 5.7 s max; x3 ≈ 20 s
  it("creates parent dirs for --report/--outdir/--out argv targets", { timeout: 20_000 }, () => {
    const dir = tmpRoot();
    const manifest = writeManifest(dir, [
      {
        id: "01",
        name: "first",
        tool: FAKE,
        kind: "node",
        argv: ["--input", "{in}", "--output", "{out}", "--tag", "A", "--report", "{outdir}/reports/01-first.json"],
      },
    ]);
    const out = join(dir, "out");
    runChain({ manifestPath: manifest, input: writeInput(dir), out });
    expect(existsSync(join(out, "reports"))).toBe(true);
    expect(existsSync(join(out, "reports", "01-first.json"))).toBe(false);
    expect(existsSync(join(out, "01-first.glb"))).toBe(true);
  });

  // CI 44195741094 measured 5.7 s max; x3 ≈ 20 s
  it("materializes a git-blob input and verifies its sha256", { timeout: 20_000 }, () => {
    const root = process.cwd();
    const ref = "HEAD:package.json";
    const bytes = execFileSync("git", ["-C", root, "show", ref]);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const dir = tmpRoot();
    const manifest = writeManifest(dir, [
      {
        id: "01",
        name: "first",
        tool: FAKE,
        kind: "node",
        argv: ["--input", "{in}", "--output", "{out}", "--tag", "A"],
        inputs: [{ name: "seed.json", gitRef: ref, sha256: sha }],
      },
    ]);
    const out = join(dir, "out");
    runChain({ manifestPath: manifest, input: writeInput(dir), out, root });
    expect(readFileSync(join(out, ".inputs", "seed.json"), "utf8")).toBe(bytes.toString("utf8"));
    expect(() =>
      runChain({
        manifestPath: writeManifest(dir, [
          {
            id: "01",
            name: "first",
            tool: FAKE,
            kind: "node",
            argv: ["--input", "{in}", "--output", "{out}"],
            inputs: [{ name: "seed.json", gitRef: ref, sha256: "0".repeat(64) }],
          },
        ]),
        input: writeInput(dir),
        out: join(dir, "out2"),
        root,
      }),
    ).toThrow(/sha256/);
  });
});
