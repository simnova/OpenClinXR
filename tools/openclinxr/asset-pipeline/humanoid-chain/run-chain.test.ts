/**
 * run-chain.test.ts — manifest schema validation, write-once refusal, and a
 * 2-stage fake-manifest run proving order plus chain-report shape.
 * No GLB fixtures from apps/; inputs are byte blobs written to tmp dirs.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAIN_CLAIM_SCOPE,
  CHAIN_NOT_EVIDENCE_FOR,
  type ChainStage,
  runChain,
  validateManifest,
} from "./run-chain";

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

describe("shipped kevin manifest (read-only validation, no stage runs)", () => {
  it("passes schema with 13 kept and 12 excluded stages", () => {
    const root = process.cwd();
    const raw = JSON.parse(
      readFileSync(join(root, "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-peds-nurse-kevin.json"), "utf8"),
    );
    const manifest = validateManifest(raw);
    expect(manifest.stages).toHaveLength(13);
    expect(manifest.excluded).toHaveLength(12);
    expect(manifest.stages.map((s) => s.id)).toEqual([
      "01", "03a", "04", "05", "08a", "08b",
      "10a", "10b", "10c", "12", "13", "17", "21",
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
    expect(manifests[0].stages).toHaveLength(13);
    expect(manifests[0].excluded).toHaveLength(12);
    expect(manifests[1].stages).toHaveLength(10);
    expect(manifests[1].excluded).toHaveLength(15);
    expect(manifests[1].stages.map((s) => s.id)).toEqual([
      "01", "03a", "04", "05", "08a", "08b", "12", "13", "17", "21",
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
