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
import { CHAIN_CLAIM_SCOPE, CHAIN_NOT_EVIDENCE_FOR, runChain, validateManifest } from "./run-chain";

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
  it("passes schema with 12 kept and 12 excluded stages", () => {
    const root = process.cwd();
    const raw = JSON.parse(
      readFileSync(join(root, "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-peds-nurse-kevin.json"), "utf8"),
    );
    const manifest = validateManifest(raw);
    expect(manifest.stages).toHaveLength(12);
    expect(manifest.excluded).toHaveLength(12);
    expect(manifest.stages.map((s) => s.id)).toEqual([
      "01", "03a", "04", "05", "08a", "08b",
      "10a", "10b", "10c", "12", "13", "17",
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
  });

  it("both shipped manifests validate (with10 + no-stage10)", () => {
    const root = process.cwd();
    const files = [
      "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-peds-nurse-kevin.json",
      "tools/openclinxr/asset-pipeline/humanoid-chain/manifests/mpfb-peds-nurse-kevin.no-stage10.json",
    ];
    const manifests = files.map((f) => validateManifest(JSON.parse(readFileSync(join(root, f), "utf8"))));
    expect(manifests[0].stages).toHaveLength(12);
    expect(manifests[0].excluded).toHaveLength(12);
    expect(manifests[1].stages).toHaveLength(9);
    expect(manifests[1].excluded).toHaveLength(15);
    expect(manifests[1].stages.map((s) => s.id)).toEqual([
      "01", "03a", "04", "05", "08a", "08b", "12", "13", "17",
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
describe("runChain", () => {
  it("runs two fake stages in order and writes the chain report", () => {
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

  it("refuses to overwrite write-once stage outputs", () => {
    const dir = tmpRoot();
    const manifest = writeManifest(dir, twoStageManifest());
    const input = writeInput(dir);
    const out = join(dir, "out");
    runChain({ manifestPath: manifest, input, out });
    expect(() => runChain({ manifestPath: manifest, input, out })).toThrow(/write-once/);
  });

  it("refuses a pre-existing out directory even when empty and writes nothing", () => {
    const dir = tmpRoot();
    const manifest = writeManifest(dir, twoStageManifest());
    const input = writeInput(dir);
    const out = join(dir, "out");
    mkdirSync(out);
    expect(() => runChain({ manifestPath: manifest, input, out })).toThrow(/write-once/);
    expect(existsSync(join(out, "chain-report.json"))).toBe(false);
    expect(existsSync(join(out, "01-first.glb"))).toBe(false);
  });

  it("a failing in-place stage leaves no final-named GLB and writes a failed report", () => {
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

  it("collects a workdir product via collectFrom", () => {
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

  it("creates parent dirs for --report/--outdir/--out argv targets", () => {
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

  it("materializes a git-blob input and verifies its sha256", () => {
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
