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
    expect(() => preImageMouthTris(REV, "0".repeat(64))).toThrow(/do not match report input\.sha256/);
  });
});
