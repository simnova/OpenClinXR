import { describe, expect, it } from "vitest";
import { serializeWithTeethSwapBlock } from "./derive_sidecar.js";

describe("teeth swap sidecar serialization", () => {
  it("appends teethSwapB1 after a formerly-final outputBytes field without invalid JSON", () => {
    const source = '{\n "outputSha256": "abc",\n "outputBytes": 123\n}\n';
    const serialized = serializeWithTeethSwapBlock(JSON.parse(source), {
      output: { sha256: "def", bytes: 456 },
    });
    expect(JSON.parse(serialized)).toEqual({
      outputSha256: "abc",
      outputBytes: 123,
      teethSwapB1: { output: { sha256: "def", bytes: 456 } },
    });
  });
});

describe("teeth swap post-step chain", () => {
  it("orders retreat, tongue, couple and quotes every path", async () => {
    const { postSteps, chainedDerivationArgv } = await import("./derive_sidecar.js");
    const steps = postSteps(["--couple", "--tongue-delta", "-0.004", "--retreat-delta", "0.0102"]);
    expect(steps.map((s) => s.tool.split("/").pop())).toEqual([
      "teeth-rest-clearance.ts",
      "tongue-forward-place.ts",
      "couple-fitted-teeth-to-lip-viseme.ts",
    ]);
    const argv = chainedDerivationArgv("tools/x/swap_teeth.py", "/tmp/it's/s.glb", steps);
    expect(argv.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(argv.slice(3)).toEqual(["x", "{pre}", "{out}", "{report}"]);
    expect(argv[2]).toBe(
      "mise exec -- python3 'tools/x/swap_teeth.py' --input \"$1\" --scratch '/tmp/it'\\''s/s.glb' --output \"$2\" --report \"$3\""
        + " && pnpm exec tsx 'tools/openclinxr/asset-pipeline/makeclothes/teeth-rest-clearance.ts' \"$2\" '--delta' '0.0102' '--in-place-bytes'"
        + " && pnpm exec tsx 'tools/openclinxr/asset-pipeline/makeclothes/tongue-forward-place.ts' \"$2\" '--delta' '-0.004' '--in-place-bytes'"
        + " && pnpm exec tsx 'tools/openclinxr/asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts' \"$2\"",
    );
  });

  it("runs decimation last, in place, and refuses a ratio without an error bound", async () => {
    const { postSteps } = await import("./derive_sidecar.js");
    const steps = postSteps(["--decimate-ratio", "0.65", "--decimate-error", "0.005", "--couple", "--retreat-delta", "0.0061"]);
    expect(steps.map((s) => s.tool.split("/").pop())).toEqual([
      "teeth-rest-clearance.ts",
      "couple-fitted-teeth-to-lip-viseme.ts",
      "decimate_teeth.mts",
    ]);
    expect(steps[2]?.args).toEqual(["--in-place", "--ratio", "0.65", "--error", "0.005"]);
    expect(() => postSteps(["--decimate-ratio", "0.65"])).toThrow(/needs --decimate-error/);
  });

  it("adds no chain when no post-step flag is given", async () => {
    const { postSteps } = await import("./derive_sidecar.js");
    expect(postSteps(["--input", "a"])).toEqual([]);
  });
});

describe("pre-image mouth triangle count", () => {
  function glb(meshes: Array<{ name: string; count: number }>): Buffer {
    const json = Buffer.from(JSON.stringify({
      meshes: meshes.map((m, i) => ({ name: m.name, primitives: [{ indices: i }] })),
      accessors: meshes.map((m) => ({ count: m.count })),
    }));
    const head = Buffer.alloc(20);
    head.write("glTF", 0, "latin1");
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(20 + json.length, 8);
    head.writeUInt32LE(json.length, 12);
    head.write("JSON", 16, "latin1");
    return Buffer.concat([head, json]);
  }

  it("counts teeth and tongue triangles and ignores other meshes", async () => {
    const { mouthTris } = await import("./derive_sidecar.js");
    // Illustrative counts, not spec values.
    expect(mouthTris(glb([{ name: "x_hm08_teeth_mesh", count: 33 }, { name: "x_tongue01", count: 9 }, { name: "x_body", count: 300 }])))
      .toEqual({ teeth: 11, tongue: 3 });
  });

  it("refuses bytes that are not a GLB", async () => {
    const { mouthTris } = await import("./derive_sidecar.js");
    expect(() => mouthTris(Buffer.from("not a glb at all, twenty+ bytes"))).toThrow(/not a GLB/);
  });
});

describe("pre-image mouth triangles from --pre-image-revision", () => {
  // ebe98e0a5 is on main; its partner blob is the teeth swap's recorded input (teethSwapB1.input.sha256).
  const REV = "ebe98e0a5:apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb";
  const SHA = "f4e9094ebb965e6296867906193df5cc1249dc3b3a55d395ca114e76b6884d67";

  it("known-good: the recorded pre-image blob counts 192 teeth and 430 tongue tris", async () => {
    const { preImageMouthTris } = await import("./derive_sidecar.js");
    expect(preImageMouthTris(REV, SHA)).toEqual({ teeth: 192, tongue: 430 });
  });

  it("throws when the revision blob sha differs from report input.sha256", async () => {
    const { preImageMouthTris } = await import("./derive_sidecar.js");
    expect(() => preImageMouthTris(REV, "0".repeat(64))).toThrow(/--pre-image-revision.*do not match report input\.sha256/);
  });
});

describe("pre-image from --pre-image-file", () => {
  // Same committed blob the revision tests above pin (teethSwapB1.input.sha256).
  const REV = "ebe98e0a5:apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb";
  const SHA = "f4e9094ebb965e6296867906193df5cc1249dc3b3a55d395ca114e76b6884d67";

  function syntheticPreImage(): { bytes: Buffer; teeth: number; tongue: number } {
    const json = Buffer.from(JSON.stringify({
      meshes: [
        { name: "x_hm08_teeth_mesh", primitives: [{ indices: 0 }] },
        { name: "x_tongue01", primitives: [{ indices: 1 }] },
      ],
      accessors: [{ count: 12 }, { count: 6 }],
    }));
    const head = Buffer.alloc(20);
    head.write("glTF", 0, "latin1");
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(20 + json.length, 8);
    head.writeUInt32LE(json.length, 12);
    head.write("JSON", 16, "latin1");
    return { bytes: Buffer.concat([head, json]), teeth: 4, tongue: 2 };
  }

  it("reads matching bytes from disk with no git blob and produces the sidecar tris", async () => {
    const mod = await import("./derive_sidecar.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const nodePath = await import("node:path");
    const { createHash } = await import("node:crypto");
    const { bytes, teeth, tongue } = syntheticPreImage();
    const sha = createHash("sha256").update(bytes).digest("hex");
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "p2c-r1-"));
    const file = nodePath.join(dir, "pre.glb");
    fs.writeFileSync(file, bytes);
    const tris = mod.resolvePreImageMouthTris(["--pre-image-file", file], sha);
    expect(tris).toEqual({ teeth, tongue });
    const sidecarPath = nodePath.join(dir, "sidecar.json");
    fs.writeFileSync(sidecarPath, mod.serializeWithTeethSwapBlock({}, { preImageMouthTris: tris }));
    expect(fs.existsSync(sidecarPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(sidecarPath, "utf8")).teethSwapB1.preImageMouthTris).toEqual({ teeth, tongue });
  });

  it("file bytes equal to the committed blob give a byte-identical sidecar", async () => {
    const mod = await import("./derive_sidecar.js");
    const { execFileSync } = await import("node:child_process");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const nodePath = await import("node:path");
    const { createHash } = await import("node:crypto");
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "p2c-w2-"));
    const file = nodePath.join(dir, "pre.glb");
    fs.writeFileSync(file, execFileSync("git", ["show", REV], { maxBuffer: 1024 * 1024 * 256 }));
    const fromRevision = mod.preImageMouthTris(REV, SHA);
    const fromFile = mod.resolvePreImageMouthTris(["--pre-image-file", file], SHA);
    expect(fromFile).toEqual(fromRevision);
    const digest = (s: string): string => createHash("sha256").update(s).digest("hex");
    const sidecarRevision = mod.serializeWithTeethSwapBlock({ v: 1 }, { preImageMouthTris: fromRevision });
    const sidecarFile = mod.serializeWithTeethSwapBlock({ v: 1 }, { preImageMouthTris: fromFile });
    expect(sidecarFile).toBe(sidecarRevision);
    console.log(`p2c W2 sidecar sha256 revision=${digest(sidecarRevision)} file=${digest(sidecarFile)}`);
  });

  it("refuses a file whose sha256 differs from report input.sha256 and writes nothing", async () => {
    const mod = await import("./derive_sidecar.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const nodePath = await import("node:path");
    const { bytes } = syntheticPreImage();
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "p2c-gate-"));
    const file = nodePath.join(dir, "pre.glb");
    fs.writeFileSync(file, bytes);
    const out = nodePath.join(dir, "sidecar.json");
    expect(() => {
      const tris = mod.resolvePreImageMouthTris(["--pre-image-file", file], "0".repeat(64));
      fs.writeFileSync(out, mod.serializeWithTeethSwapBlock({}, { preImageMouthTris: tris }));
    }).toThrow(/do not match report input\.sha256/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("refuses when neither pre-image flag is given and writes nothing", async () => {
    const mod = await import("./derive_sidecar.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const nodePath = await import("node:path");
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "p2c-neither-"));
    const out = nodePath.join(dir, "sidecar.json");
    expect(() => {
      const tris = mod.resolvePreImageMouthTris([], SHA);
      fs.writeFileSync(out, mod.serializeWithTeethSwapBlock({}, { preImageMouthTris: tris }));
    }).toThrow(/--pre-image-revision.*--pre-image-file/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it("H2 file: mismatched pre-image leaves --sidecar bytes unchanged and --output absent (gate before any write)", async () => {
    const mod = await import("./derive_sidecar.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const nodePath = await import("node:path");
    const { createHash } = await import("node:crypto");
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "p2c2-h2-file-"));
    const preFile = nodePath.join(dir, "pre.glb");
    fs.writeFileSync(preFile, Buffer.from("p2c2-h2-file-preimage-bytes"));
    const sidecar = nodePath.join(dir, "sidecar.json");
    fs.writeFileSync(sidecar, JSON.stringify({ outputSha256: "old", outputBytes: 1 }));
    const before = fs.readFileSync(sidecar);
    const beforeSha = createHash("sha256").update(before).digest("hex");
    const inputP = nodePath.join(dir, "in.glb");
    fs.writeFileSync(inputP, "in");
    const reportP = nodePath.join(dir, "report.json");
    fs.writeFileSync(reportP, JSON.stringify({ schema: "openclinxr-teeth-swap-report.v1", input: { path: inputP, sha256: "0".repeat(64), bytes: 1 } }));
    const outP = nodePath.join(dir, "out.glb");
    const workDir = nodePath.join(dir, "work");
    let message = "";
    try {
      mod.deriveTeethSwapSidecar(["--input", inputP, "--scratch", nodePath.join(dir, "s.glb"), "--output", outP, "--sidecar", sidecar, "--report", reportP, "--pre-image-file", preFile, "--working-directory", workDir]);
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/--pre-image-file.*do not match report input\.sha256/);
    const after = fs.readFileSync(sidecar);
    const afterSha = createHash("sha256").update(after).digest("hex");
    expect(afterSha).toBe(beforeSha);
    expect(fs.existsSync(outP)).toBe(false);
    console.log(`h2 file sidecar sha256 before=${beforeSha} after=${afterSha}`);
  });

  it("H2 revision: mismatched pre-image leaves --sidecar bytes unchanged and --output absent (gate before any write)", async () => {
    const mod = await import("./derive_sidecar.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const nodePath = await import("node:path");
    const { createHash } = await import("node:crypto");
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "p2c2-h2-rev-"));
    const REV_PIN = "ebe98e0a5:apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb";
    const sidecar = nodePath.join(dir, "sidecar.json");
    fs.writeFileSync(sidecar, JSON.stringify({ outputSha256: "old", outputBytes: 1 }));
    const before = fs.readFileSync(sidecar);
    const beforeSha = createHash("sha256").update(before).digest("hex");
    const inputP = nodePath.join(dir, "in.glb");
    fs.writeFileSync(inputP, "in");
    const reportP = nodePath.join(dir, "report.json");
    fs.writeFileSync(reportP, JSON.stringify({ schema: "openclinxr-teeth-swap-report.v1", input: { path: inputP, sha256: "0".repeat(64), bytes: 1 } }));
    const outP = nodePath.join(dir, "out.glb");
    const workDir = nodePath.join(dir, "work");
    let message = "";
    try {
      mod.deriveTeethSwapSidecar(["--input", inputP, "--scratch", nodePath.join(dir, "s.glb"), "--output", outP, "--sidecar", sidecar, "--report", reportP, "--pre-image-revision", REV_PIN, "--working-directory", workDir]);
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/--pre-image-revision.*do not match report input\.sha256/);
    const after = fs.readFileSync(sidecar);
    const afterSha = createHash("sha256").update(after).digest("hex");
    expect(afterSha).toBe(beforeSha);
    expect(fs.existsSync(outP)).toBe(false);
    console.log(`h2 revision sidecar sha256 before=${beforeSha} after=${afterSha}`);
  });

  it("CW-H5: source bytes changed between gate and corrector call are refused, --sidecar unchanged, --output absent", async () => {
    const deriveMod = await import("./derive_sidecar.js");
    const correctMod = await import("../../../evidence/licence/correct-sidecar-byte-lineage.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const nodePath = await import("node:path");
    const { createHash } = await import("node:crypto");
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "p2c2-h5-"));
    const glb = (tag: string): Buffer => {
      const json = Buffer.from(JSON.stringify({ meshes: [{ name: "x_hm08_teeth_mesh", primitives: [{ indices: 0 }] }], accessors: [{ count: 12 }], tag }));
      const head = Buffer.alloc(20);
      head.write("glTF", 0, "latin1");
      head.writeUInt32LE(2, 4);
      head.writeUInt32LE(20 + json.length, 8);
      head.writeUInt32LE(json.length, 12);
      head.write("JSON", 16, "latin1");
      return Buffer.concat([head, json]);
    };
    const preFile = nodePath.join(dir, "pre.glb");
    fs.writeFileSync(preFile, glb("a"));
    const source = { kind: "file", path: preFile } as const;
    // Gate call passes on bytes A.
    const gateBytes = correctMod.readPreImageBytes(source);
    const gateSha = createHash("sha256").update(gateBytes).digest("hex");
    expect(() => deriveMod.preImageMouthTrisForSource(source, gateSha)).not.toThrow();
    // The file changes before the corrector's own read.
    fs.writeFileSync(preFile, glb("b-changed"));
    const correctorReadSha = createHash("sha256").update(fs.readFileSync(preFile)).digest("hex");
    const sidecar = nodePath.join(dir, "sidecar.json");
    fs.writeFileSync(sidecar, JSON.stringify({ outputSha256: "old", outputBytes: 1 }));
    const beforeSha = createHash("sha256").update(fs.readFileSync(sidecar)).digest("hex");
    const outP = nodePath.join(dir, "out.glb");
    let message = "";
    try {
      correctMod.correctSidecarByteLineage({
        assetPath: outP,
        provenancePath: sidecar,
        preImage: { kind: "file", path: preFile },
        expectedPreImageSha256: gateSha,
        derivationArgv: ["node", "--version"],
        why: "cw-h5 test",
        workingDirectory: nodePath.join(dir, "work"),
      });
    } catch (e) {
      message = String(e);
    }
    expect(message).toContain(gateSha);
    expect(message).toContain(correctorReadSha);
    const afterSha = createHash("sha256").update(fs.readFileSync(sidecar)).digest("hex");
    expect(afterSha).toBe(beforeSha);
    expect(fs.existsSync(outP)).toBe(false);
    console.log(`cw-h5 sidecar sha256 before=${beforeSha} after=${afterSha} gate=${gateSha} reread=${correctorReadSha}`);
  });

  it("refuses when both pre-image flags are given and writes nothing", async () => {
    const mod = await import("./derive_sidecar.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const nodePath = await import("node:path");
    const { bytes } = syntheticPreImage();
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "p2c-both-"));
    const file = nodePath.join(dir, "pre.glb");
    fs.writeFileSync(file, bytes);
    const out = nodePath.join(dir, "sidecar.json");
    expect(() => {
      const tris = mod.resolvePreImageMouthTris(["--pre-image-revision", REV, "--pre-image-file", file], SHA);
      fs.writeFileSync(out, mod.serializeWithTeethSwapBlock({}, { preImageMouthTris: tris }));
    }).toThrow(/--pre-image-revision.*--pre-image-file/);
    expect(fs.existsSync(out)).toBe(false);
  });
});
